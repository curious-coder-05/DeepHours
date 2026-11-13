import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Sheet } from './Sheet';
import { ListGroup, ListRow } from './ListRow';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  subtitle?: string;
  swatchColor?: string;
  icon?: React.ReactNode;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  title?: string;
  placeholder?: string;
  'aria-label'?: string;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
}

export function Select<T extends string = string>({
  value,
  options,
  onChange,
  title,
  placeholder = 'Select an option',
  'aria-label': ariaLabelDash,
  ariaLabel: ariaLabelCamel,
  id,
  disabled = false,
}: SelectProps<T>) {
  const ariaLabel = ariaLabelDash || ariaLabelCamel || title || placeholder || 'Select option';
  const [open, setOpen] = useState(false);
  const selected = options.find((opt) => opt.value === value);

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          minHeight: '44px',
          padding: '8px 12px',
          borderRadius: '12px',
          background: 'var(--sf-2)',
          border: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          textAlign: 'left',
          color: 'var(--tx)',
          fontWeight: 500,
          fontSize: '14px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flex: 1,
          }}
        >
          {selected?.swatchColor && (
            <span
              aria-hidden="true"
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '99px',
                background: selected.swatchColor,
                flexShrink: 0,
              }}
            />
          )}
          {selected?.icon}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
          style={{ color: 'var(--tx-2)', flexShrink: 0 }}
        />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={title || ariaLabel}
      >
        <ListGroup>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <ListRow
                key={opt.value}
                title={opt.label}
                subtitle={opt.subtitle}
                leading={
                  opt.swatchColor ? (
                    <span
                      aria-hidden="true"
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '6px',
                        background: opt.swatchColor,
                        border: '1px solid var(--line)',
                      }}
                    />
                  ) : (
                    opt.icon
                  )
                }
                trailing={
                  isSelected ? (
                    <Check
                      size={18}
                      strokeWidth={2}
                      style={{ color: 'var(--ac-ink)' }}
                      aria-hidden="true"
                    />
                  ) : undefined
                }
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              />
            );
          })}
        </ListGroup>
      </Sheet>
    </>
  );
}
