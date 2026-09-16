#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EasyConnect 二进制补丁（修复启动段错误）

问题：EasyConnect 自带旧版 harfbuzz，并把 274 个 `hb_*` 符号导出为全局符号，
      运行时会“抢占”系统 libharfbuzz (Fedora 44 为 14.x) 的符号解析，
      造成 ABI 不匹配，程序一启动就在 pango/harfbuzz 里 SIGSEGV。
      EasyConnect 是 ET_EXEC，无法用 dlopen 隔离，只能改它的导出符号。

方案：把可执行文件导出的 `hb_*` 符号改名，使其不再对外抢占。
      因为 ELF 的 .gnu.hash 由符号名计算而来，直接改名会让程序自身
      的调用也找不到符号（报 undefined symbol），所以采用“保桶重命名”：
        - 新名字的 GNU hash 取模 nbuckets 后仍等于原 bucket；
        - 同步更新 .gnu.hash 里对应符号的 chain 哈希值；
        - 把新 hash 的两个 bloom 位补进 bloom 过滤器。
      这样对外不再抢占系统库，对内仍然能正确解析自己的符号。

用法：
    python3 patch_hb_symbols.py <原始 EasyConnect 可执行文件> <输出文件>

示例：
    cp /usr/share/sangfor/EasyConnect/EasyConnect.orig /tmp/EasyConnect.new
    python3 patch_hb_symbols.py /tmp/EasyConnect.new /tmp/EasyConnect.patched
    sudo cp /tmp/EasyConnect.patched /usr/share/sangfor/EasyConnect/EasyConnect
"""
import struct
import sys
import itertools


def gnu_hash(name: bytes) -> int:
    h = 5381
    for c in name:
        h = ((h * 33) + c) & 0xFFFFFFFF
    return h


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    data = bytearray(open(src, 'rb').read())

    if data[:4] != b'\x7fELF' or data[4] != 2 or data[5] != 1:
        sys.exit("只支持 64 位小端 ELF")

    e_shoff = struct.unpack_from('<Q', data, 0x28)[0]
    e_shentsize = struct.unpack_from('<H', data, 0x3A)[0]
    e_shnum = struct.unpack_from('<H', data, 0x3C)[0]
    e_shstrndx = struct.unpack_from('<H', data, 0x3E)[0]

    def section(i):
        o = e_shoff + i * e_shentsize
        name = struct.unpack_from('<I', data, o)[0]
        off, size = struct.unpack_from('<QQ', data, o + 0x18)
        return name, off, size

    shstr = section(e_shstrndx)
    names = data[shstr[1]:shstr[1] + shstr[2]]
    secs = {}
    for i in range(e_shnum):
        nm, off, size = section(i)
        secs[names[nm:names.index(b'\0', nm)].decode()] = (off, size)

    go, _ = secs['.gnu.hash']
    do, ds = secs['.dynsym']
    so, _ = secs['.dynstr']
    nbuckets, symndx, bloom_size, bloom_shift = struct.unpack_from('<IIII', data, go)
    bloom_off = go + 16
    buckets_off = bloom_off + bloom_size * 8
    chain_off = buckets_off + nbuckets * 4
    nsyms = ds // 24

    def sym_name(i):
        st_name = struct.unpack_from('<I', data, do + i * 24)[0]
        p = so + st_name
        return p, data[p:data.index(b'\0', p)]

    used = {bytes(sym_name(i)[1]) for i in range(nsyms)}

    chars = b'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    renamed = 0
    for i in range(nsyms):
        st_shndx = struct.unpack_from('<H', data, do + i * 24 + 6)[0]
        if st_shndx == 0:
            continue
        bind = struct.unpack_from('B', data, do + i * 24 + 4)[0] >> 4
        if bind not in (1, 2):  # GLOBAL / WEAK
            continue
        p, name = sym_name(i)
        if not name.startswith(b'hb_'):
            continue

        target = gnu_hash(bytes(name)) % nbuckets
        suffix = bytes(name[3:])
        new = None
        for combo in itertools.product(chars, repeat=3):
            cand = bytes(combo) + suffix
            if cand in used:
                continue
            if gnu_hash(cand) % nbuckets == target:
                new = cand
                break
        if new is None:
            sys.exit("无法为 %r 找到保桶新名字" % bytes(name))

        used.discard(bytes(name))
        used.add(new)
        data[p:p + 3] = new[:3]

        new_h = gnu_hash(new)
        w = (new_h // 64) % bloom_size
        word = struct.unpack_from('<Q', data, bloom_off + w * 8)[0]
        word |= (1 << (new_h % 64)) | (1 << ((new_h >> bloom_shift) % 64))
        struct.pack_into('<Q', data, bloom_off + w * 8, word & 0xFFFFFFFFFFFFFFFF)

        co = chain_off + (i - symndx) * 4
        old_chain = struct.unpack_from('<I', data, co)[0]
        struct.pack_into('<I', data, co, (old_chain & 1) | (new_h & ~1))
        renamed += 1

    open(dst, 'wb').write(data)
    print("已重命名 %d 个 hb_* 符号" % renamed)


if __name__ == '__main__':
    main()
