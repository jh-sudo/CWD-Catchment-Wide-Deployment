// JSON.stringify() alone doesn't escape `<`, so a value containing the
// literal string "</script>" (e.g. an admin-editable name field) can break
// out of a server-rendered `<script>...${value}...</script>` block. Escaping
// `<` to its unicode form neutralizes that without changing the parsed JSON
// value at all — used anywhere server data is embedded straight into an
// inline <script> tag (crew.ts's OFFICER, manager.ts's CURRENT_USER, …).
export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
