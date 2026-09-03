import os from "node:os";

// Some Windows/Node 24 environments fail uv_os_get_passwd with ENOMEM while
// TSX discovers its temporary directory. Preserve the native implementation
// whenever it works and provide only the minimum fallback TSX needs.
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    username: process.env.USERNAME ?? "vaanigam",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE ?? process.cwd(),
  });
}
