/**
 * Renders a dynamic form straight from a VCF Automation catalog item's
 * request schema, so the portal's input UI matches the real catalog.
 *
 * VCF Automation's custom form schema roughly follows JSON Schema
 * (properties / required / enum / $dynamicEnum, etc.), but the exact
 * shape can vary by blueprint, so this parses defensively.
 */

function normalizeProperties(schema) {
  if (!schema) return {};
  return (
    schema.properties ||
    schema.schema?.properties ||
    schema.inputSchema?.properties ||
    {}
  );
}

function normalizeRequired(schema) {
  return schema?.required || schema?.schema?.required || [];
}

function fieldKind(key, prop) {
  if (prop.encrypted || prop.format === "password" || /password|secret|token/i.test(key)) {
    return "password";
  }
  if (prop.enum || prop.oneOf) return "select";
  if (prop["$dynamicEnum"] || prop.dynamicEnum) return "dynamic-enum";
  if (prop.type === "boolean") return "checkbox";
  if (prop.type === "integer" || prop.type === "number") return "number";
  if (
    prop.type === "string" &&
    (prop.format === "textarea" ||
      prop.mediaType === "text/plain" ||
      /script|cloudinit|runcmd|body/i.test(key))
  ) {
    return "textarea";
  }
  return "text";
}

function optionsFor(prop) {
  if (prop.enum) {
    return prop.enum.map((v, i) => ({
      value: v,
      label: prop.enumTitles?.[i] || prop.title_map?.[v] || String(v),
    }));
  }
  if (prop.oneOf) {
    return prop.oneOf.map((o) => ({ value: o.const ?? o.enum?.[0], label: o.title || String(o.const) }));
  }
  return [];
}

export default function DynamicForm({ schema, values, onChange }) {
  const properties = normalizeProperties(schema);
  const required = new Set(normalizeRequired(schema));
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <div className="empty-state">
        이 항목에는 파싱 가능한 입력 스키마가 없습니다. VCF 콘솔에서 직접 요청하거나,
        관리자에게 커스텀 폼 등록을 문의하세요.
      </div>
    );
  }

  const setValue = (key, val) => onChange({ ...values, [key]: val });

  return (
    <div>
      {keys.map((key) => {
        const prop = properties[key] || {};
        const kind = fieldKind(key, prop);
        const label = prop.title || key;
        const isRequired = required.has(key);
        const value = values[key] ?? prop.default ?? "";

        return (
          <div className={`field ${kind === "checkbox" ? "field-checkbox" : ""}`} key={key}>
            {kind === "checkbox" ? (
              <>
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => setValue(key, e.target.checked)}
                />
                <label>
                  {label}
                  {isRequired ? " *" : ""}
                </label>
              </>
            ) : (
              <>
                <label>
                  {label}
                  {isRequired ? " *" : ""}
                </label>

                {kind === "select" && (
                  <select value={value} onChange={(e) => setValue(key, e.target.value)}>
                    <option value="" disabled>
                      선택하세요
                    </option>
                    {optionsFor(prop).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {kind === "dynamic-enum" && (
                  <input
                    type="text"
                    value={value}
                    placeholder="동적 값 (VCF 액션 기반) - 직접 입력"
                    onChange={(e) => setValue(key, e.target.value)}
                  />
                )}

                {kind === "textarea" && (
                  <textarea
                    rows={6}
                    value={value}
                    onChange={(e) => setValue(key, e.target.value)}
                  />
                )}

                {kind === "number" && (
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(key, e.target.valueAsNumber)}
                  />
                )}

                {kind === "password" && (
                  <input
                    type="password"
                    value={value}
                    onChange={(e) => setValue(key, e.target.value)}
                  />
                )}

                {kind === "text" && (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(key, e.target.value)}
                  />
                )}

                {prop.description && <span className="hint">{prop.description}</span>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
