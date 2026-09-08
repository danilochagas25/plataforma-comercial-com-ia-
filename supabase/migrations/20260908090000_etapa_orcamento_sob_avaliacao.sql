-- ============================================================================
-- Renomeia "Orçamento apresentado" → "Orçamento sob avaliação"
--
-- Decisão do Danilo em 08/09/2026. "Não aprovado" soa como decisão já tomada,
-- e não é isso que a coluna contém: são os 81 orçamentos de pacientes que
-- receberam o plano de tratamento e **ainda estão decidindo**. O nome novo
-- descreve o estado real e é o que a recepção vai procurar na tela.
--
-- A etapa "Não aprovado" continua existindo, vazia, com o sentido estrito de
-- quem recusou em definitivo.
--
-- ⚠️ O NOME DA ETAPA É CHAVE DE BUSCA, não só rótulo. `src/lib/odontoImport.ts`
-- procura a etapa por `name` (constante ETAPA_APRESENTADO) — renomear aqui sem
-- mudar lá faz a importação parar com "A etapa X não existe no funil". Falha
-- limpa, sem corromper dado, mas para. As duas coisas andam juntas.
--
-- Idempotente: roda quantas vezes for preciso, e não toca em instalação que já
-- tenha o nome novo.
-- ============================================================================

SET search_path TO whatsapp_hub;

UPDATE stages s
   SET name = 'Orçamento sob avaliação'
  FROM pipelines p
 WHERE p.id = s.pipeline_id
   AND p.name = 'Odonto — Orçamentos'
   AND s.name = 'Orçamento apresentado';
