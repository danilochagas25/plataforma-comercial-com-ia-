import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Instagram, Loader2, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useAuth } from '@/app/providers/AuthProvider';
import { BRAND } from '@/config/brand';

const DEFAULT_PROMPT = `Você é um assistente virtual de atendimento via WhatsApp.
Seja objetivo, educado e responda em português do Brasil.`;

// Modelos GPT disponíveis para escolha (mais recentes primeiro).
const GPT_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
];

// Modelos Claude (Anthropic). O provedor não é um campo próprio: ele é
// derivado do modelo escolhido (ver providerOf), o que evita uma coluna nova
// no banco e impede a combinação inválida "provedor X com modelo de Y".
const CLAUDE_MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
];

function providerOf(model: string): 'openai' | 'claude' {
  return model.startsWith('claude-') ? 'claude' : 'openai';
}

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Manaus',
  'America/Rio_Branco',
  'America/Bahia',
  'UTC',
];

const DEFAULT_VARIABLES: Record<string, string> = {
  nome_do_agente: 'Alex',
  nome_da_empresa: BRAND.companyName,
  segmento: 'Educação em IA',
  produtos_servicos: 'Ferramentas de IA',
};

// Variáveis preenchidas automaticamente em runtime (process-ai-message).
// Aparecem no autocomplete mas não são editáveis aqui.
const AUTO_VARS = [
  'nome_do_contato',
  'agora',
  'dentro_do_horario',
  'horario_atendimento',
  'mensagem_fora_horario',
  'midias_disponiveis',
];

type VarRow = { key: string; value: string };

function toRows(obj: Record<string, string> | null | undefined): VarRow[] {
  const src = obj && Object.keys(obj).length ? obj : DEFAULT_VARIABLES;
  return Object.entries(src).map(([key, value]) => ({ key, value: String(value ?? '') }));
}

export function AIAgentSettings() {
  const { userId } = useAppUser();
  const { session } = useAuth();
  const [rowId, setRowId] = useState<string | null>(null);
  // Credenciais de LLM (em org_settings, salvas via /api/credentials).
  // openai_api_key: embeddings (RAG), transcrição de áudio e leitura de imagem
  // são sempre OpenAI. As respostas do agente podem vir da OpenAI ou do Claude,
  // conforme o modelo escolhido — com Claude, a chave OpenAI é opcional e o que
  // depende dela é simplesmente pulado.
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiKeyExists, setOpenaiKeyExists] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicKeyExists, setAnthropicKeyExists] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [activeWhatsapp, setActiveWhatsapp] = useState(true);
  const [activeInstagram, setActiveInstagram] = useState(false);
  const [autoMoveLeads, setAutoMoveLeads] = useState(true);
  const [model, setModel] = useState('gpt-4.1-mini');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [variables, setVariables] = useState<VarRow[]>(toRows(DEFAULT_VARIABLES));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Descobre quais chaves já estão configuradas (para o placeholder). A API só
  // devolve se existe — nunca o valor.
  useEffect(() => {
    if (!session) return;
    fetch('/api/credentials?keys=openai_api_key,anthropic_api_key', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((b) => {
        setOpenaiKeyExists(Boolean(b?.openai_api_key?.exists));
        setAnthropicKeyExists(Boolean(b?.anthropic_api_key?.exists));
      })
      .catch(() => {});
  }, [session]);

  // Autocomplete de variáveis ao digitar "{" no prompt.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [varMenu, setVarMenu] = useState<{ partial: string; pos: number } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    supabase
      .from('ai_agent_config')
      .select('*')
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRowId(data.id as string);
          setSystemPrompt((data.system_prompt as string) ?? DEFAULT_PROMPT);
          setTemperature(Number(data.temperature ?? 0.7));
          setMaxTokens(Number(data.max_tokens ?? 1000));
          setActiveWhatsapp(Boolean(data.active_whatsapp ?? true));
          setActiveInstagram(Boolean(data.active_instagram ?? false));
          setAutoMoveLeads(Boolean(data.auto_move_leads ?? true));
          setModel((data.model as string) ?? 'gpt-4.1-mini');
          setTimezone((data.timezone as string) ?? 'America/Sao_Paulo');
          setVariables(toRows(data.variables as Record<string, string> | null));
        }
        setLoading(false);
      });
  }, [userId]);

  const varKeys = useMemo(
    () => [...variables.map((v) => v.key.trim()).filter(Boolean), ...AUTO_VARS],
    [variables],
  );

  const menuMatches = useMemo(() => {
    if (!varMenu) return [];
    const p = varMenu.partial.toLowerCase();
    return varKeys.filter((k) => k.toLowerCase().startsWith(p)).slice(0, 8);
  }, [varMenu, varKeys]);

  const onPromptChange = (value: string) => {
    setSystemPrompt(value);
    const caret = promptRef.current?.selectionStart ?? value.length;
    // Texto entre o último "{" e o cursor, sem "}" no meio → abre o menu.
    const before = value.slice(0, caret);
    const match = before.match(/\{([a-z0-9_]*)$/i);
    if (match) setVarMenu({ partial: match[1], pos: caret - match[1].length });
    else setVarMenu(null);
  };

  const insertVariable = (key: string) => {
    if (!varMenu) return;
    const start = varMenu.pos;
    const caret = promptRef.current?.selectionStart ?? systemPrompt.length;
    const next = systemPrompt.slice(0, start) + key + '}' + systemPrompt.slice(caret);
    setSystemPrompt(next);
    setVarMenu(null);
    // Reposiciona o cursor após o "}".
    const newCaret = start + key.length + 1;
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const setVar = (i: number, patch: Partial<VarRow>) =>
    setVariables((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const addVar = () => setVariables((prev) => [...prev, { key: '', value: '' }]);
  const removeVar = (i: number) => setVariables((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    // Normaliza variáveis: chaves a-z0-9_ , descarta linhas sem chave.
    const varsObj: Record<string, string> = {};
    for (const { key, value } of variables) {
      const k = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (k) varsObj[k] = value;
    }
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
      // Sempre ativo globalmente; quem liga/desliga a IA são os toggles por canal.
      is_active: true,
      active_whatsapp: activeWhatsapp,
      active_instagram: activeInstagram,
      auto_move_leads: autoMoveLeads,
      model,
      timezone,
      variables: varsObj,
    };
    const { error } = rowId
      ? await supabase.from('ai_agent_config').update(payload).eq('id', rowId)
      : await supabase.from('ai_agent_config').insert(payload);
    if (error) {
      setSaving(false);
      toast.error('Falha ao salvar', { description: error.message });
      return;
    }

    // Credenciais: chave só é gravada se o usuário digitou uma nova (campo
    // vazio mantém a atual). O provedor acompanha o modelo escolhido — não é
    // um campo separado, para não existir "provedor X com modelo de Y".
    const credentials: Record<string, string> = { llm_provider: providerOf(model) };
    if (openaiKey.trim()) credentials.openai_api_key = openaiKey.trim();
    if (anthropicKey.trim()) credentials.anthropic_api_key = anthropicKey.trim();

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ credentials }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message ?? 'Falha ao salvar a chave.');
      if (openaiKey.trim()) {
        setOpenaiKeyExists(true);
        setOpenaiKey('');
      }
      if (anthropicKey.trim()) {
        setAnthropicKeyExists(true);
        setAnthropicKey('');
      }
    } catch (err) {
      setSaving(false);
      toast.error('Config salva, mas a chave de IA falhou', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
      return;
    }

    setSaving(false);
    toast.success('Configuração do agente salva.');
  };

  if (loading) {
    return (
      <Card>
        <div className="text-label opacity-60 py-8 text-center">Carregando...</div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-xl font-bold text-display">Configuração do agente</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            O system prompt define a personalidade e as regras. Use {'{variavel}'} para
            inserir variáveis (digite {'{'} para escolher).
          </p>
        </header>

        <div className="space-y-2 relative">
          <Label htmlFor="system_prompt">System prompt</Label>
          <textarea
            id="system_prompt"
            ref={promptRef}
            value={systemPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={() => setTimeout(() => setVarMenu(null), 150)}
            rows={12}
            disabled={saving}
            className="w-full rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--accent-primary)] focus:bg-[#EEF6F7]"
          />
          {varMenu && menuMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-64 rounded-lg border border-[rgba(97,193,208,0.55)] bg-[#FFFFFF] shadow-2xl overflow-hidden">
              {menuMatches.map((k) => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertVariable(k);
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-mono text-[var(--color-text-primary)] hover:bg-[rgba(97,193,208,0.30)]"
                >
                  {`{${k}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Variáveis */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Variáveis</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addVar} disabled={saving}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
            Chave e valor. Referencie no prompt com {'{chave}'}. Automáticas (preenchidas
            em runtime): {AUTO_VARS.map((k) => `{${k}}`).join(', ')}.
          </p>
          <div className="space-y-2">
            {variables.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={v.key}
                  onChange={(e) => setVar(i, { key: e.target.value })}
                  placeholder="chave"
                  disabled={saving}
                  className="font-mono max-w-[220px]"
                />
                <span className="text-[var(--color-text-secondary)]">=</span>
                <Input
                  value={v.value}
                  onChange={(e) => setVar(i, { value: e.target.value })}
                  placeholder="valor"
                  disabled={saving}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeVar(i)}
                  disabled={saving}
                  aria-label="Remover variável"
                >
                  <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Canais ativos (Módulo 6) — cada canal liga/desliga a IA de forma
            independente. Desligado → conversas do canal vão direto para humano.
            São o interruptor principal da IA (não há mais toggle global). */}
        <div className="space-y-2">
          <Label>Canais atendidos pela IA</Label>
          <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
            Ligue ou desligue a IA por canal. Se um canal estiver desligado, as conversas
            dele vão direto para atendimento humano.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
            <label className="flex items-center gap-3 h-11 px-4 rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] cursor-pointer">
              <input
                type="checkbox"
                checked={activeWhatsapp}
                onChange={(e) => setActiveWhatsapp(e.target.checked)}
                disabled={saving}
                className="accent-[var(--accent-primary)] h-4 w-4"
              />
              <MessageCircle className="h-4 w-4 text-[#0B7A43]" />
              <span className="text-sm text-[var(--color-text-primary)]">
                Ativo no WhatsApp
              </span>
            </label>
            <label className="flex items-center gap-3 h-11 px-4 rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] cursor-pointer">
              <input
                type="checkbox"
                checked={activeInstagram}
                onChange={(e) => setActiveInstagram(e.target.checked)}
                disabled={saving}
                className="accent-[var(--accent-primary)] h-4 w-4"
              />
              <Instagram className="h-4 w-4 text-[#C82461]" />
              <span className="text-sm text-[var(--color-text-primary)]">
                Ativo no Instagram
              </span>
            </label>
          </div>
        </div>

        {/* Movimento automático de leads no funil (Módulo 8) */}
        <div className="space-y-2">
          <Label>Funil</Label>
          <label className="flex items-center gap-3 min-h-11 px-4 py-2 rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] cursor-pointer max-w-2xl">
            <input
              type="checkbox"
              checked={autoMoveLeads}
              onChange={(e) => setAutoMoveLeads(e.target.checked)}
              disabled={saving}
              className="accent-[var(--accent-primary)] h-4 w-4 shrink-0"
            />
            <span className="text-sm text-[var(--color-text-primary)]">
              Mover as pessoas pelas etapas automaticamente
              <span className="block text-[11px] text-[var(--color-text-secondary)]">
                Com sinal claro, a IA move o card entre etapas (que tenham critério definido) e
                registra no histórico. Reversível arrastando de volta.
              </span>
            </span>
          </label>
        </div>

        {/* Configurações Avançadas */}
        <div className="rounded-xl border border-[rgba(97,193,208,0.30)] bg-[#FAFDFD]">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Configurações Avançadas
            </div>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-[rgba(97,193,208,0.30)] p-5">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="openai_api_key">OpenAI API Key</Label>
                <Input
                  id="openai_api_key"
                  type="password"
                  autoComplete="off"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={openaiKeyExists ? '•••••••••••• (configurada)' : 'sk-...'}
                  disabled={saving}
                />
                <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
                  Transcrição de áudio, leitura de imagem e busca na base de conhecimento são
                  sempre da OpenAI. {providerOf(model) === 'claude'
                    ? 'Como o modelo escolhido é Claude, esta chave é opcional — sem ela, áudio e foto vão direto para o atendimento humano.'
                    : 'Com um modelo GPT, ela também gera as respostas do agente.'}{' '}
                  Deixe em branco para manter a chave atual.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="anthropic_api_key">Anthropic API Key (Claude)</Label>
                <Input
                  id="anthropic_api_key"
                  type="password"
                  autoComplete="off"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={anthropicKeyExists ? '•••••••••••• (configurada)' : 'sk-ant-...'}
                  disabled={saving}
                />
                <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
                  Necessária apenas se o modelo escolhido abaixo for um Claude. Deixe em branco
                  para manter a chave atual.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Modelo de IA</Label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={saving}
                  className="h-11 w-full rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 text-sm text-[var(--color-text-primary)]"
                >
                  <optgroup label="Claude (Anthropic)">
                    {CLAUDE_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="GPT (OpenAI)">
                    {GPT_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
                  O provedor acompanha o modelo: escolher um Claude passa as respostas para a
                  Anthropic; um GPT, para a OpenAI.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Fuso horário</Label>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={saving}
                  className="h-11 w-full rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 text-sm text-[var(--color-text-primary)]"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="temperature">Temperature ({temperature.toFixed(1)})</Label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  disabled={saving}
                  className="w-full accent-[var(--accent-primary)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max_tokens">Max tokens</Label>
                <Input
                  id="max_tokens"
                  type="number"
                  min={100}
                  max={8000}
                  step={100}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  disabled={saving}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>Salvar alterações</>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
