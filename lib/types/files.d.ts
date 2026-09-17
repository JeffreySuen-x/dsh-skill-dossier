/** 本模块用到的最小路径操作子集。 */
export interface PathFns {
    basename(p: string): string;
    dirname(p: string): string;
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    relative(from: string, to: string): string;
    isAbsolute(p: string): boolean;
    sep: string;
}
/** 默认按运行平台（node:path）。 */
export declare const defaultPath: PathFns;
/**
 * 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
 *
 * 判据必须是**按路径段**比较：早期版本用 `rel.startsWith('..')`，于是 `<dir>/..foo/x`
 * 这种名字以 `..` 开头的正常子目录会被误判成「在外面」。这不是纯美观问题——调用方
 * 拿它决定沙箱档位（`isWithin(target, ws) ? 'workspace-write' : 'danger-full-access'`），
 * 误判会把本可受限执行的 `mv`/`rm -rf` 升格成全权执行。
 *
 * `relative` 跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。
 */
export declare function isWithin(candidate: string, dir: string, p?: PathFns): boolean;
interface MovableSkill {
    name: string;
    path?: string;
}
/**
 * 从注册表定义解析可移动的文件系统条目（只信任注册表给的路径）。
 *
 * 判据是**路径形状**，不是「目录名等于技能名」：只要注册表给的 `path` 是
 * `<root>/<dir>/SKILL.md` 或 `<root>/<name>.md`，root 就由路径反推。
 * 早期版本额外要求 `basename(dirname(path)) === skill.name`，于是目录名与
 * frontmatter `name` 不一致的技能（本机实测 4 个：`book-to-skill-master`、
 * `god-skill-main` 等）会被误判成「不是文件系统技能」，生命周期操作全废。
 * 目录名是源仓库的目录名，frontmatter `name` 才是调用名——两者不必然相等。
 *
 * 路径必须是绝对的：`'SKILL.md'` 这种相对路径会反推出 `root: '..'`，而 root 会喂给
 * `trashDirOf()` 与 `rm -rf`，entry 会作为 `mv` 的源（cwd = root）。
 */
export declare function fsEntryOf(skill: MovableSkill, p?: PathFns): {
    entry: string;
    root: string;
} | undefined;
/** trash 目录：与技能根同级（技能根父目录下的 skill-manager/trash）。 */
export declare function trashDirOf(root: string, p?: PathFns): string;
/** 把值转成 shell 单引号参数（POSIX：内嵌单引号写成 '\''）。 */
export declare function quoteShellArg(value: string): string;
export declare function mkdirCommand(dir: string): string;
export declare function moveNoClobberCommand(src: string, dst: string): string;
export declare function removeRecursiveCommand(path: string): string;
/** Replace a file by renaming a same-directory temporary file over it. */
export declare function atomicReplaceCommand(src: string, dst: string): string;
/** Remove one staging file without interpreting wildcard characters. */
export declare function removeFileCommand(path: string): string;
export {};
//# sourceMappingURL=files.d.ts.map