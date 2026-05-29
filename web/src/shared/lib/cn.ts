/**
 * 轻量级 CSS classname 合并工具。
 * 过滤掉 falsy 值后以空格拼接。
 * 替代项目中分散的 `${a} ${b}` 手动拼接模式。
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
