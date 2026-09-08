import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Menu que se abre FORA da árvore onde o botão vive.
//
// Por que isto existe: a lista de conversas e a thread são containers com
// `overflow-y-auto`. Pela especificação do CSS, um overflow vertical diferente
// de `visible` força o horizontal a também recortar — então um menu posicionado
// com `absolute` dentro deles é cortado nas laterais e embaixo, mesmo com
// z-index alto. Foi exatamente o que aconteceu: nos balões junto à borda
// esquerda o menu aparecia com uma tira de 100px e o resto invisível.
//
// A saída é renderizar em `document.body` (portal) com `position: fixed`,
// medindo o botão para escolher o lado. Assim o menu só depende da janela.

interface FloatingMenuProps {
  /** Elemento que ancora o menu (normalmente o botão que o abriu). */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Alinhamento preferido; vira o contrário se não couber. */
  align?: 'left' | 'right';
  width: number;
  children: ReactNode;
}

const MARGEM = 8;

export function FloatingMenu({
  anchorRef,
  open,
  onClose,
  align = 'right',
  width,
  children,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Posiciona depois de montar, quando já dá para medir a altura real do menu
  // (ela varia: o submenu de silenciar cresce, o de mensagem tem mais itens).
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const altura = menuRef.current?.offsetHeight ?? 0;

    const espacoAbaixo = window.innerHeight - a.bottom - MARGEM;
    const espacoAcima = a.top - MARGEM;
    // Abre para cima quando não cabe embaixo E há mais espaço em cima.
    const paraCima = altura > espacoAbaixo && espacoAcima > espacoAbaixo;

    const top = paraCima ? Math.max(MARGEM, a.top - altura - 4) : a.bottom + 4;
    const maxHeight = Math.max(160, paraCima ? espacoAcima : espacoAbaixo);

    let left = align === 'right' ? a.right - width : a.left;
    // Encosta na janela em vez de sair dela — é o caso do balão colado na
    // borda esquerda da conversa.
    left = Math.min(left, window.innerWidth - width - MARGEM);
    left = Math.max(MARGEM, left);

    setPos({ top, left, maxHeight });
  }, [open, anchorRef, align, width, children]);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const onDown = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (menuRef.current?.contains(alvo)) return;
      if (anchorRef.current?.contains(alvo)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Com `fixed`, rolar a conversa deixaria o menu parado sobre outra
    // mensagem. Fechar é mais honesto do que reposicionar a cada quadro.
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        width,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxHeight,
        // Antes da primeira medição o menu já está no DOM (para ter altura),
        // mas fora da tela e invisível — senão pisca no canto.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-[100] overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--color-border-card)] bg-[var(--color-bg-surface)] shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}
