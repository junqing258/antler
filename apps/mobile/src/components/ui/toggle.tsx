import { Host, Switch } from "@expo/ui";

/** @expo/ui Switch 的项目最小封装：受控开关 + 标签（doc 19 阶段 4 试点）。 */
export function Toggle({
  value,
  onChange,
  label,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Host matchContents>
      <Switch
        value={value}
        onValueChange={onChange}
        label={label}
        disabled={disabled}
      />
    </Host>
  );
}
