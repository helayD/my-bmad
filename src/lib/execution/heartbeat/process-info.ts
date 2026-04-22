/** 获取当前进程和父进程信息（用于心跳中的 PID 快照） */
export async function getProcessInfo(): Promise<{
  pid: number;
  ppid: number;
  hostname: string;
} | null> {
  try {
    const { pid, ppid } = process;
    const hostname = process.env["HOSTNAME"] ?? "unknown";
    return { pid, ppid, hostname };
  } catch {
    return null;
  }
}
