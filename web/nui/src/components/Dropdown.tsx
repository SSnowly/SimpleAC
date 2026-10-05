import { Check, ChevronDown } from 'lucide-react';
import { useId, useRef, useState } from 'react';

export function Dropdown({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <fieldset
      className="custom-dropdown"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        role="combobox"
        type="button"
        className="dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setActive(Math.max(0, options.indexOf(value)));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            setOpen(true);
            setActive(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)),
                    ),
            );
          }
          if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            const next = options[active];
            if (next) onChange(next);
            setOpen(false);
          }
        }}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
      >
        {value}
        <ChevronDown size={15} />
      </button>
      {open && (
        <div id={id} role="listbox" aria-label={label} className="dropdown-options">
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option}
              id={`${id}-${index}`}
              key={option}
              className={active === index ? 'highlighted' : ''}
              onPointerMove={() => setActive(index)}
              onClick={() => {
                onChange(option);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {option}
              {value === option && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
