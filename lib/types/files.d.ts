/** 本模块用到的最小路径操作子集。 */
export interface PathFns {
    basename(p: string): string;
    dirname(p: string): string;
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    relative(from: string, to: string): string;
    isAbsolute(p: string): boolean;
}
/** 默认按运行平台（node:path）。 */
export declare const defaultPath: PathFns;
/** 判断 candidate 词法解析后是否仍在 dir 目录内（解析 `..`，不解析符号链接）。
 * `relative` 在跨盘（Windows）时返回目标绝对路径，故用 isAbsolute 一并拦截。 */
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
 */
export declare function fsEntryOf(skill: MovableSkill, p?: PathFns): {
    entry: string;
    root: string;
} | undefined;
/** trash 目录：与技能根同级（技能根父目录下的 skill-manager/trash）。 */
export declare function trashDirOf(root: string, p?: PathFns): string;
/** 把值转成 shell 单引号参数（POSIX 用 '\''，pwsh 用 ''）。 */
export declare function quoteShellArg(value: string, isWindows: boolean): string;
export declare function mkdirCommand(dir: string, isWindows: boolean): string;
export declare function moveNoClobberCommand(src: string, dst: string, isWindows: boolean): string;
export declare function removeRecursiveCommand(path: string, isWindows: boolean): string;
/** Replace a file by renaming a same-directory temporary file over it. */
export declare function atomicReplaceCommand(src: string, dst: string, isWindows: boolean): string;
/** Remove one staging file without interpreting wildcard characters. */
export declare function removeFileCommand(path: string, isWindows: boolean): string;
export {};
//# sourceMappingURL=files.d.ts.map