export const USERNAME_RULE_HINT = '中文2—8字，英文4—16位；混合时汉字算2位，总长4—16位。支持汉字、字母、数字、下划线，不能为纯数字。';

export function usernameLength(value: string): number {
  return Array.from(value).reduce((total, char) => total + (char.codePointAt(0)! > 127 ? 2 : 1), 0);
}

export function validUsername(value: string): boolean {
  return /^[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9_]+$/.test(value)
    && /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z]/.test(value)
    && usernameLength(value) >= 4 && usernameLength(value) <= 16;
}
