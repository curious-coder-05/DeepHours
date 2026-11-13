import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  'aria-label'?: string;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  'aria-label': ariaLabel,
  label,
  disabled = false,
  id,
}) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel || label || 'Toggle'}
    disabled={disabled}
    className="dh-switch"
    onClick={() => onChange(!checked)}
  >
    <span className="dh-switch-knob" aria-hidden="true" />
  </button>
);
