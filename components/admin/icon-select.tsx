"use client";

import { useId, useMemo, useState } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { FieldLabel, FieldRoot } from "@/components/base/field";
import { selectItemClass, selectPopupClass, selectTriggerClass } from "@/components/base/select";
import { listIcons, normalizeIconId, resolveLinkIconSrc } from "@/lib/icons";
import { cn } from "@/lib/utils";

function applyCustomLabelTemplate(id: string, template?: string): string {
  if (!template) return id;
  return template.split("{id}").join(id);
}

function IconGlyph({ src, className, size = 20 }: { src: string; className?: string; size?: number }) {
  const isRemote = /^https?:\/\//i.test(src);
  if (isRemote) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("object-contain opacity-90", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        width: size,
        height: size,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

/**
 * Props must be serializable (strings/objects). Do not pass functions from RSC.
 */
export function IconSelect({
  id,
  name = "icon",
  label,
  defaultValue = "link",
  customLabelTemplate,
  className,
}: {
  id?: string;
  name?: string;
  label: string;
  defaultValue?: string;
  customLabelTemplate?: string;
  className?: string;
}) {
  const autoId = useId();
  const fieldId = id || `icon-select-${autoId}`;
  const initial = normalizeIconId(defaultValue || "link");
  const builtin = useMemo(() => listIcons(), []);
  const knownIds = useMemo(() => new Set(builtin.map((i) => i.id)), [builtin]);
  const isKnownInitial = knownIds.has(initial);

  type Option = { id: string; label: string };
  const options = useMemo((): Option[] => {
    const list: Option[] = builtin.map((i) => ({ id: i.id, label: i.label }));
    if (!isKnownInitial && initial) {
      list.unshift({
        id: initial,
        label: applyCustomLabelTemplate(initial, customLabelTemplate),
      });
    }
    return list;
  }, [builtin, initial, isKnownInitial, customLabelTemplate]);

  const [value, setValue] = useState(initial);
  const selected = options.find((o) => o.id === value) || options[0];

  return (
    <FieldRoot className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <input type="hidden" name={name} value={value} />
      <Select.Root value={value} onValueChange={(next) => setValue(String(next))}>
        <Select.Trigger id={fieldId} className={selectTriggerClass} aria-label={label}>
          <span className="flex min-w-0 items-center gap-2">
            {selected ? <IconGlyph src={resolveLinkIconSrc(selected.id)} /> : null}
            <span className="truncate">{selected?.label ?? value}</span>
          </span>
          <Select.Icon className="shrink-0 text-admin-muted">
            <ChevronDown className="size-4" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="outline-none" sideOffset={6} alignItemWithTrigger={false}>
            <Select.Popup className={cn(selectPopupClass, "w-[var(--anchor-width)] min-w-56")}>
              <Select.List>
                {options.map((opt) => (
                  <Select.Item key={opt.id} value={opt.id} className={selectItemClass}>
                    <IconGlyph src={resolveLinkIconSrc(opt.id)} />
                    <span className="min-w-0 flex-1">
                      <Select.ItemText className="block truncate text-admin-text">
                        {opt.label}
                      </Select.ItemText>
                      <span className="mt-0.5 block truncate text-xs text-admin-muted">{opt.id}</span>
                    </span>
                    <Select.ItemIndicator className="mt-0.5 shrink-0 text-admin-strong">
                      <Check className="size-4" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </FieldRoot>
  );
}
