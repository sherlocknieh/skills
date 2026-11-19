import { Plugin } from "@opencode/plugin"

const userHome = process.env.HOME || process.env.USERPROFILE 

export default Plugin.define({
  id: "askpass",
  async setup(ctx) {
    await ctx.shell.hook("create.before", (event) => {
      if (!event.env.SUDO_ASKPASS) {
        event.env.SUDO_ASKPASS = `${userHome}/.config/opencode/sudo-askpass.sh`
      }
      if (!event.env.SSH_ASKPASS) {
        event.env.SSH_ASKPASS = `${userHome}/.config/opencode/ssh-askpass.sh`
      }
    })
  },
})
