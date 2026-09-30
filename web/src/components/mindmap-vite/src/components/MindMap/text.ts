/** 文本度量与换行 —— 不依赖 canvas，纯字符宽度估算，保证 SSR / 测试可用。 */

/** 单个字符的宽度（相对字号的倍数） */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x20 || code === 0x09) return 0.3;
  // CJK / 全角标点 / 日文假名 / 韩文
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  if ("iljtfrI.,:;'|!()[]{}".includes(ch)) return 0.32;
  if ("mwMW@".includes(ch)) return 0.88;
  return 0.56;
}

export function measureText(text: string, fontSize: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * fontSize * (bold ? 1.06 : 1);
}

export interface TextMetrics {
  lines: string[];
  /** 文本块宽度 */
  width: number;
  /** 文本块高度 */
  height: number;
  lineHeight: number;
}

/**
 * 按最大宽度对文本换行（中文逐字断行，西文优先按空格断行），
 * 同时尊重用户输入的显式换行符 \n。
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  bold = false
): TextMetrics {
  const lineHeight = Math.round(fontSize * 1.45);
  const explicit = String(text ?? "").split("\n");
  const lines: string[] = [];

  for (const raw of explicit) {
    if (raw === "") {
      lines.push("");
      continue;
    }
    if (measureText(raw, fontSize, bold) <= maxWidth) {
      lines.push(raw);
      continue;
    }
    // 先按空格切成词，再逐个塞进一行；超长词再逐字拆
    const words = raw.split(/(?<=\s)/);
    let cur = "";
    const pushCur = () => {
      if (cur !== "") lines.push(cur.replace(/\s+$/, ""));
      cur = "";
    };
    for (const word of words) {
      if (measureText(cur + word, fontSize, bold) <= maxWidth) {
        cur += word;
        continue;
      }
      pushCur();
      if (measureText(word, fontSize, bold) <= maxWidth) {
        cur = word;
        continue;
      }
      // 逐字硬拆
      let chunk = "";
      for (const ch of word) {
        if (measureText(chunk + ch, fontSize, bold) <= maxWidth) {
          chunk += ch;
        } else {
          lines.push(chunk);
          chunk = ch;
        }
      }
      cur = chunk;
    }
    pushCur();
  }

  if (lines.length === 0) lines.push("");
  const width = Math.max(...lines.map((l) => measureText(l, fontSize, bold)), 0);
  return { lines, width, height: lines.length * lineHeight, lineHeight };
}
