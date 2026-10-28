/**
 * Bubblewrap seccomp BPF (G1-05).
 *
 * bwrap --seccomp FD expects a raw sock_filter[] (same payload as
 * seccomp_export_bpf). Deny-list of jail-escape / privileged syscalls;
 * everything else is allowed so bash/python/pytest/git still run.
 * Production must apply this filter; workstation may omit it if encode fails.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BPF_LD_W_ABS = 0x20;
const BPF_JEQ_K = 0x15;
const BPF_RET_K = 0x06;

const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
/** SECCOMP_RET_ERRNO | EPERM */
const SECCOMP_RET_ERRNO_EPERM = 0x00050001;

const OFF_NR = 0;
const OFF_ARCH = 4;

/** AUDIT_ARCH_* (64-bit little-endian). */
export const AUDIT_ARCH: Record<string, number> = {
  x64: 0xc000003e,
  arm64: 0xc00000b7,
};

/**
 * Syscall numbers to deny. x64: unistd_64.h. arm64: asm-generic unistd.h.
 * Not a published sandbox profile — blocks the usual breakout calls.
 */
export const DENY_SYSCALLS: Record<string, readonly number[]> = {
  x64: [
    101, // ptrace
    103, // syslog
    134, // uselib
    135, // personality
    153, // vhangup
    155, // pivot_root
    159, // adjtimex
    163, // acct
    164, // settimeofday
    165, // mount
    166, // umount2
    167, // swapon
    168, // swapoff
    169, // reboot
    170, // sethostname
    171, // setdomainname
    172, // iopl
    173, // ioperm
    174, // create_module
    175, // init_module
    176, // delete_module
    179, // quotactl
    212, // lookup_dcookie
    227, // clock_settime
    246, // kexec_load
    248, // add_key
    249, // request_key
    250, // keyctl
    272, // unshare
    298, // perf_event_open
    305, // clock_adjtime
    308, // setns
    310, // process_vm_readv
    311, // process_vm_writev
    312, // kcmp
    313, // finit_module
    320, // kexec_file_load
    321, // bpf
    323, // userfaultfd
    428, // open_tree
    429, // move_mount
    430, // fsopen
    431, // fsconfig
    432, // fsmount
    433, // fspick
    438, // pidfd_getfd
    442, // mount_setattr
  ],
  arm64: [
    18, // lookup_dcookie
    39, // umount2
    40, // mount
    41, // pivot_root
    58, // vhangup
    60, // quotactl
    89, // acct
    92, // personality
    97, // unshare
    104, // kexec_load
    105, // init_module
    106, // delete_module
    112, // clock_settime
    116, // syslog
    117, // ptrace
    142, // reboot
    161, // sethostname
    162, // setdomainname
    170, // settimeofday
    171, // adjtimex
    217, // add_key
    218, // request_key
    219, // keyctl
    224, // swapon
    225, // swapoff
    241, // perf_event_open
    266, // clock_adjtime
    268, // setns
    270, // process_vm_readv
    271, // process_vm_writev
    272, // kcmp
    273, // finit_module
    280, // bpf
    282, // userfaultfd
    294, // kexec_file_load
    428, // open_tree
    429, // move_mount
    430, // fsopen
    431, // fsconfig
    432, // fsmount
    433, // fspick
    438, // pidfd_getfd
    442, // mount_setattr
  ],
};

export const BWRAP_SECCOMP_FD = 3;

function insn(code: number, k: number, jt = 0, jf = 0): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(code & 0xffff, 0);
  b.writeUInt8(jt & 0xff, 2);
  b.writeUInt8(jf & 0xff, 3);
  b.writeUInt32LE(k >>> 0, 4);
  return b;
}

export function encodeSeccompBpf(arch: string = process.arch): Buffer {
  const audit = AUDIT_ARCH[arch];
  const nrs = DENY_SYSCALLS[arch];
  if (audit === undefined || !nrs) {
    throw new Error(`unsupported seccomp arch ${arch}`);
  }
  const out: Buffer[] = [
    insn(BPF_LD_W_ABS, OFF_ARCH),
    insn(BPF_JEQ_K, audit, 1, 0),
    insn(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
    insn(BPF_LD_W_ABS, OFF_NR),
  ];
  for (const nr of nrs) {
    out.push(insn(BPF_JEQ_K, nr, 0, 1));
    out.push(insn(BPF_RET_K, SECCOMP_RET_ERRNO_EPERM));
  }
  out.push(insn(BPF_RET_K, SECCOMP_RET_ALLOW));
  return Buffer.concat(out);
}

let cached: { arch: string; path: string } | undefined;

/** Write (or reuse) the BPF blob. Throws if encode/write fails. */
export function prepareBwrapSeccomp(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.SPOCKIFY_BWRAP_SECCOMP || '').trim();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    throw new Error('bwrap seccomp disabled by SPOCKIFY_BWRAP_SECCOMP=0');
  }
  const arch = process.arch;
  if (cached && cached.arch === arch && existsSync(cached.path)) {
    return cached.path;
  }
  const bpf = encodeSeccompBpf(arch);
  const dir = env.XDG_RUNTIME_DIR || tmpdir();
  const dest = path.join(dir, `spockify-seccomp-${arch}.bpf`);
  writeFileSync(dest, bpf);
  cached = { arch, path: dest };
  return dest;
}
