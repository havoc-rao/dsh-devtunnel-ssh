import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { userInfo, platform } from 'node:os';
import { join } from 'node:path';

// Return ordinary command arguments; all validation/consent remains in the command layer.
export async function wizard(args, { input = stdin, output = stdout } = {}) {
  if (!['host', 'pair'].includes(args[0]) || args.length !== 1) return args;
  if (!input.isTTY) throw new Error('Interactive mode needs a terminal; use explicit options shown by --help');
  const rl = createInterface({ input, output });
  async function ask(label, fallback = '') {
    const value = (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)).trim();
    return value || fallback;
  }
  try {
    output.write('dsh-link 实验版配对向导\n不会自动安装服务、登录或开放匿名隧道。两端需用可信渠道交换文件并核对校验码。\n');
    if (args[0] === 'pair') {
      const invite = await ask('被连接端发来的邀请文件路径');
      const out = await ask('响应文件输出路径', 'client-response.dshlink');
      if ((await ask('将生成本机专用 SSH 密钥（无口令、限制目录权限），继续？输入 yes')) !== 'yes') throw new Error('Cancelled; no pairing key generated');
      return ['pair', '--invite', invite, '--out', out];
    }
    const action = await ask('1 创建邀请 / 2 接受控制端响应', '1');
    if (action === '1') {
      const name = await ask('设备名称', 'My-PC');
      const username = userInfo().username;
      output.write(`仅配置当前账户：${username}\n请先在官方 Dev Tunnel CLI 中准备稳定的私有隧道并发布 SSH 端口。\n`);
      const tunnel = await ask('稳定 Tunnel ID（不是浏览器 URL）');
      const port = await ask('远端 SSH 端口', '22');
      const keyDefault = platform() === 'win32' ? join(process.env.ProgramData || 'C:\\ProgramData', 'ssh', 'ssh_host_ed25519_key.pub') : '/private/etc/ssh/ssh_host_ed25519_key.pub';
      const key = await ask('本机 SSH 主机公钥路径（只能 .pub，不能私钥）', keyDefault);
      const out = await ask('邀请文件输出路径', 'host-invite.dshlink');
      return ['host', 'invite', '--name', name, '--username', username, '--tunnel', tunnel, '--port', port, '--host-key', key, '--out', out];
    }
    if (action === '2') {
      const invite = await ask('本机创建的邀请文件路径', 'host-invite.dshlink');
      const response = await ask('控制端响应文件路径', 'client-response.dshlink');
      output.write('先查看授权计划。要应用请按输出提示显式传入 --confirm 和 --apply；本步骤不会写 SSH 授权文件。\n');
      return ['host', 'accept', '--invite', invite, '--response', response];
    }
    throw new Error('Unknown selection');
  } finally { rl.close(); }
}
