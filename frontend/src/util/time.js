// 백엔드는 timezone 표기가 없는 UTC(naive) 문자열을 내려준다.
// 그대로 new Date()에 넣으면 브라우저 로컬 시간으로 해석되므로 UTC로 명시한다.
export function parseUtc(value) {
  if (!value) return null;
  const s = String(value);
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(hasTz ? s : `${s}Z`);
}

export function formatKst(value) {
  const d = parseUtc(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}
