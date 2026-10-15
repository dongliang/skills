// 安装 agent skill —— 首选 npx skills add，失败则自己往已知目录写
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const SKILL_MD = join(PKG_ROOT, 'SKILL.md');

// 各 agent 的 skill 目录（装了就往这些地方放）
const KNOWN_DIRS = [
  '~/.claude/skills',
  '~/.codex/skills',
  '~/.config/agent-skills',
  '~/.agents/skills',
];

export async function installSkill({ global: isGlobal = true } = {}) {
  const log = console.log;

  // 1) 首选：npx skills add（走官方生态，兼容性最好）
  log('尝试 `npx skills add` …');
  const r = spawnSync('npx', ['-y', 'skills@latest', 'add', 'dongliang/skills', '--skill', 'bilibili-transcript',
                              isGlobal ? '-g' : '-p', '-y'],
                      { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status === 0) {
    log('\n✅ 已通过 npx skills 安装。');
    return true;
  }

  // 2) 降级：自己往已知目录写
  log(`\n⚠️  npx skills 不可用（退出码 ${r.status}），改用内置安装：`);
  if (!existsSync(SKILL_MD)) {
    log(`❌ 找不到 ${SKILL_MD}，无法安装。`);
    return false;
  }

  const targets = KNOWN_DIRS
    .map((d) => d.replace(/^~/, homedir()))
    .filter((d) => existsSync(dirname(d)));

  if (!targets.length) {
    log('❌ 没有找到任何已知的 agent skill 目录。');
    log('   请手动把包里的 SKILL.md 复制到你的 agent skill 目录。');
    return false;
  }

  for (const t of targets) {
    const dest = join(t, 'bilibili-transcript');
    try {
      mkdirSync(dest, { recursive: true });
      copyFileSync(SKILL_MD, join(dest, 'SKILL.md'));
      log(`  ✅ ${dest}/SKILL.md`);
    } catch (e) {
      log(`  ❌ ${dest}：${e.message}`);
    }
  }

  log('\n注意：降级安装只放 SKILL.md，agent 需要能通过 `npx bili-transcript` 调用工具。');
  return true;
}
