import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, ExternalLink, Pencil, X } from 'lucide-react';
import type { CredentialField as CredentialFieldConfig } from '../../../setup.config';
import { cn } from '@/lib/utils';

type CredentialFieldProps = {
  field: CredentialFieldConfig;
  initialHasValue: boolean;
  onChange: (key: string, value: string | null) => void;
  onValidationChange?: (key: string, isValid: boolean) => void;
};

type ValidationState =
  | { state: 'idle'; message?: string }
  | { state: 'validating'; message?: string }
  | { state: 'valid'; message?: string }
  | { state: 'invalid'; message: string };

export function CredentialField({
  field,
  initialHasValue,
  onChange,
  onValidationChange,
}: CredentialFieldProps) {
  const [editing, setEditing] = useState(!initialHasValue);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({ state: 'idle' });

  // SetupPage passes `onValidationChange` as an inline arrow, so its identity
  // changes on every parent render. Holding both callbacks in refs keeps them
  // out of the validation effect's dependency list — otherwise the effect
  // re-ran on every render, cleared its own 800ms debounce before it could
  // fire (so a field stayed on "Validando..." forever) and, because the effect
  // also calls onChange -> setState in the parent, looped into a "Maximum
  // update depth exceeded" crash.
  const onChangeRef = useRef(onChange);
  const onValidationChangeRef = useRef(onValidationChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onValidationChangeRef.current = onValidationChange;
  });

  useEffect(() => {
    setEditing(!initialHasValue);
    setValue('');
    setValidation({ state: initialHasValue ? 'valid' : 'idle' });
  }, [initialHasValue]);

  useEffect(() => {
    onChangeRef.current(field.key, value.trim() ? value : null);
    if (!editing || !value.trim()) {
      onValidationChangeRef.current?.(field.key, initialHasValue && !editing);
      return;
    }
    setValidation({ state: 'validating' });
    const timeout = window.setTimeout(async () => {
      try {
        // Validation runs server-side (api/validate) so the credential value
        // never reaches the third-party provider straight from the browser.
        const res = await fetch('/api/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'app', key: field.key, value: value.trim() }),
        });
        const result = (await res.json()) as { ok: boolean; message?: string };
        setValidation(
          result.ok
            ? { state: 'valid', message: result.message }
            : { state: 'invalid', message: result.message ?? 'Credencial invalida.' },
        );
        onValidationChangeRef.current?.(field.key, result.ok);
      } catch (err) {
        setValidation({
          state: 'invalid',
          message: err instanceof Error ? err.message : 'Falha ao validar.',
        });
        onValidationChangeRef.current?.(field.key, false);
      }
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [editing, field, initialHasValue, value]);

  const inputType = useMemo(() => {
    if (field.inputType !== 'password') return 'text';
    return show ? 'text' : 'password';
  }, [field.inputType, show]);

  if (!editing && initialHasValue) {
    return (
      <div className="rounded-xl border border-[rgba(97,193,208,0.30)] bg-[#FAFDFD] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#5C7378]">{field.label}</div>
            <div className="mt-2 font-mono text-sm text-[#17282B]">••••••••</div>
            {field.helpText ? (
              <p className="mt-2 text-[13px] leading-5 text-[#4E666B]">{field.helpText}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 text-sm font-medium text-[#17282B] transition hover:border-[#0A7787] hover:shadow-[0_4px_14px_rgba(23,40,43,0.08)]"
          >
            <Pencil className="h-4 w-4" />
            Alterar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[rgba(97,193,208,0.30)] bg-[#FAFDFD] p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={field.key} className="text-[13px] font-medium text-[#5C7378]">
          {field.label}
        </label>
        {field.docsUrl ? (
          <a
            href={field.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[#0B6E7D] hover:text-[#0B6E7D]"
          >
            onde gerar
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="relative">
        <input
          id={field.key}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type={inputType}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 py-3 pr-20 text-sm text-[#17282B] placeholder:text-[#4E666B] focus:border-[#0A7787] focus:outline-none focus:shadow-[0_4px_14px_rgba(23,40,43,0.08)]"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {field.inputType === 'password' ? (
            <button
              type="button"
              aria-label={show ? 'Ocultar' : 'Mostrar'}
              onClick={() => setShow((next) => !next)}
              className="text-[#4E666B] hover:text-[#17282B]"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : null}
          {validation.state === 'valid' ? <Check className="h-4 w-4 text-[#0C6B4A]" /> : null}
          {validation.state === 'invalid' ? <X className="h-4 w-4 text-[#B02D26]" /> : null}
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={cn(
            'text-[13px] leading-5',
            validation.state === 'invalid' ? 'text-[#B02D26]' : 'text-[#4E666B]',
          )}
        >
          {validation.state === 'validating'
            ? 'Validando...'
            : validation.state === 'invalid'
              ? validation.message
              : field.helpText}
        </p>
        {initialHasValue ? (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue('');
              onChange(field.key, null);
            }}
            className="text-sm text-[#4E666B] hover:text-[#17282B]"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}
