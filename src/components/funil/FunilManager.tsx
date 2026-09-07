import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, GripVertical, Plus, Power, PowerOff, Star, Trash2, X } from 'lucide-react';
import type { FunilController } from '@/app/routes/funil/FunilPage';
import type { Stage } from '@/types/crm';

const STAGE_COLORS = ['#0A7787', '#0B6E7D', '#0C6B4A', '#9A4A07', '#B02D26', '#6D28D9', '#4E666B'];

export function FunilManager({ funil, onClose }: { funil: FunilController; onClose: () => void }) {
  const {
    pipelines, inactivePipelines, selectedId, select, stages,
    createPipeline, renamePipeline, deletePipeline, setDefaultPipeline, setPipelineActive,
    addStage, renameStage, setStageColor, setStageProbability, setStageAiCriteria, reorderStages, removeStage,
  } = funil;

  const [newFunil, setNewFunil] = useState('');
  const [newStage, setNewStage] = useState('');
  const [busy, setBusy] = useState(false);
  const dragIdx = useRef<number | null>(null);

  const inputCls =
    'w-full rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]';

  const handleCreateFunil = async () => {
    if (!newFunil.trim()) return;
    setBusy(true);
    await createPipeline(newFunil);
    setNewFunil('');
    setBusy(false);
  };

  // Desativar é a ação preferida: o funil sai dos seletores mas os deals e o
  // histórico continuam no banco. Excluir só serve para funil vazio.
  const handleToggleAtivo = async (id: string, ativo: boolean) => {
    const res = await setPipelineActive(id, ativo);
    if (!res.ok) toast.error(res.error ?? 'Falha ao mudar o estado do funil.');
    else toast.success(ativo ? 'Funil reativado.' : 'Funil desativado (não foi excluído).');
  };

  const handleDeleteFunil = async (id: string) => {
    const res = await deletePipeline(id);
    if (!res.ok) toast.error(res.error ?? 'Falha ao excluir funil.');
    else toast.success('Funil excluído.');
  };

  const onStageDrop = (targetIdx: number) => {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === targetIdx) return;
    const ids = stages.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(targetIdx, 0, moved);
    void reorderStages(ids);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,40,43,0.38)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] shadow-[0_8px_28px_rgba(23,40,43,0.12)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-card)] px-5 py-4">
          <h3 className="text-base font-bold text-display">Gerenciar funis</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          {/* Coluna: funis */}
          <section className="space-y-3">
            <div className="text-label">Funis</div>
            <div className="space-y-2">
              {pipelines.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-lg border px-3 py-2 ${p.id === selectedId ? 'border-[var(--accent-primary)] bg-[var(--color-bg-subtle)]' : 'border-[var(--color-border-card)]'}`}
                >
                  <div className="flex items-center gap-2">
                    <button onClick={() => select(p.id)} className="flex-1 text-left text-sm text-[var(--color-text-primary)]">
                      {p.name}
                    </button>
                    <button
                      title="Definir como padrão"
                      onClick={() => void setDefaultPipeline(p.id)}
                      className={p.is_default ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-warning)]'}
                    >
                      <Star className="h-4 w-4" fill={p.is_default ? '#9A4A07' : 'none'} />
                    </button>
                    <button
                      title="Desativar (não exclui: os deals e o histórico ficam)"
                      onClick={() => void handleToggleAtivo(p.id, false)}
                      className="text-[var(--color-text-secondary)] hover:text-[var(--color-warning)]"
                    >
                      <PowerOff className="h-4 w-4" />
                    </button>
                    <button title="Excluir" onClick={() => void handleDeleteFunil(p.id)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    defaultValue={p.name}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value !== p.name) void renamePipeline(p.id, e.target.value); }}
                    className="mt-1 w-full rounded border border-[var(--color-border-card)] bg-transparent px-2 py-1 text-xs text-[var(--color-text-secondary)] outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
              ))}
            </div>
            {inactivePipelines.length > 0 && (
              <div className="rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] p-3">
                <div className="text-label mb-2">Desativados</div>
                <div className="space-y-1.5">
                  {inactivePipelines.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <span className="flex-1 truncate">{p.name}</span>
                      <button
                        title="Reativar"
                        onClick={() => void handleToggleAtivo(p.id, true)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--color-border-card)] px-2 py-1 text-xs hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
                      >
                        <Power className="h-3 w-3" /> Reativar
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-label)]">
                  Funil desativado não aparece nos seletores, mas nada foi excluído.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <input value={newFunil} onChange={(e) => setNewFunil(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newFunil.trim() && !busy) void handleCreateFunil(); }} placeholder="Novo funil…" className={inputCls} />
              <button onClick={handleCreateFunil} disabled={busy || !newFunil.trim()} className="rounded-lg bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </section>

          {/* Coluna: estágios do funil selecionado */}
          <section className="space-y-3">
            <div className="text-label">Etapas de “{pipelines.find((p) => p.id === selectedId)?.name ?? '-'}”</div>
            <div className="space-y-2">
              {stages.map((s, i) => (
                <StageRow
                  key={s.id}
                  stage={s}
                  stages={stages}
                  onDragStart={() => (dragIdx.current = i)}
                  onDrop={() => onStageDrop(i)}
                  onRename={(name) => void renameStage(s.id, name)}
                  onColor={(c) => void setStageColor(s.id, c)}
                  onProbability={(p) => void setStageProbability(s.id, p)}
                  onAiCriteria={(t) => void setStageAiCriteria(s.id, t)}
                  onRemove={(moveTo) => removeStage(s.id, moveTo)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newStage} onChange={(e) => setNewStage(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && newStage.trim()) { await addStage(newStage); setNewStage(''); } }} placeholder="Nova etapa…" className={inputCls} />
              <button
                onClick={async () => { if (newStage.trim()) { await addStage(newStage); setNewStage(''); } }}
                disabled={!newStage.trim()}
                className="rounded-lg bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-text-label)]">Arraste pela alça para reordenar.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function StageRow({
  stage, stages, onDragStart, onDrop, onRename, onColor, onProbability, onAiCriteria, onRemove,
}: {
  stage: Stage;
  stages: Stage[];
  onDragStart: () => void;
  onDrop: () => void;
  onRename: (name: string) => void;
  onColor: (color: string | null) => void;
  onProbability: (probability: number) => void;
  onAiCriteria: (criteria: string) => void;
  onRemove: (moveToStageId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const others = stages.filter((s) => s.id !== stage.id);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="rounded-lg border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] px-2 py-2"
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--color-text-secondary)]" />
        <input
          defaultValue={stage.name}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== stage.name) onRename(e.target.value); }}
          className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
        />
        {(stage.is_won || stage.is_lost) && (
          <span className="text-[10px] text-[var(--color-text-secondary)]">{stage.is_won ? 'ganho' : 'perdido'}</span>
        )}
        <button title="Excluir etapa" onClick={() => setConfirming((v) => !v)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)]">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6">
        <div className="flex items-center gap-1">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColor(stage.color === c ? null : c)}
              className={`h-3.5 w-3.5 rounded-full ring-offset-2 ring-offset-[var(--surface)] ${stage.color === c ? 'ring-2 ring-[var(--accent-primary)]' : ''}`}
              style={{ background: c }}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
        {/* Probabilidade de fechamento (forecast) */}
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
          Prob.
          <input
            type="number"
            min={0}
            max={100}
            defaultValue={stage.probability}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v !== stage.probability) onProbability(v);
            }}
            className="w-14 rounded border border-[var(--color-border-card)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
          />
          %
        </label>
      </div>

      {/* Critério para a IA mover o lead para este estágio (Módulo 8) */}
      <div className="mt-1.5 pl-6">
        <textarea
          defaultValue={stage.ai_criteria ?? ''}
          onBlur={(e) => { if (e.target.value.trim() !== (stage.ai_criteria ?? '').trim()) onAiCriteria(e.target.value); }}
          rows={2}
          placeholder="Critério p/ a IA mover o paciente p/ cá (ex.: pediu proposta). Vazio = a IA não move para esta etapa."
          className="w-full resize-y rounded border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent-primary)]"
        />
      </div>

      {confirming && (
        <div className="mt-2 space-y-2 rounded-md border border-[rgba(176,45,38,0.28)] bg-[var(--color-error-bg)] p-2">
          <div className="text-[11px] text-[var(--color-text-secondary)]">Mover orçamentos desta etapa para:</div>
          <div className="flex items-center gap-2">
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="flex-1 rounded border border-[var(--color-border-card)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)] outline-none">
              <option value="">Selecione…</option>
              {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              disabled={!moveTo}
              onClick={async () => {
                const res = await onRemove(moveTo);
                if (!res.ok) toast.error(res.error ?? 'Falha ao excluir.');
                else { toast.success('Etapa excluída.'); setConfirming(false); }
              }}
              className="inline-flex items-center gap-1 rounded bg-[var(--color-error)] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
