import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { SupportBanner } from './SupportBanner';

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <SupportBanner />
        <Header onMenuClick={() => setMobileNavOpen(true)} />

        {/* A marca ao fundo da área de trabalho. `relative` aqui é o que
            ancora a marca d'água absoluta abaixo. */}
        <main className="relative flex-1 overflow-auto" role="main">
          {/*
            Marca d'água. Regras que a mantêm discreta o bastante para ter
            texto por cima sem prejudicar a leitura:
            · opacidade baixa (o símbolo é turquesa cheio — acima disso ele
              compete com o conteúdo);
            · `pointer-events-none` para não interceptar clique nenhum;
            · `select-none` e `aria-hidden` para não entrar em seleção de
              texto nem em leitor de tela — é decoração, não informação;
            · `sticky` no centro da altura visível, para acompanhar a rolagem
              em vez de sumir no topo de uma lista longa;
            · escondida no celular (`hidden sm:block`), onde a tela é pequena
              e a marca só faria disputar espaço com o conteúdo.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none select-none sticky top-1/2 z-0 hidden h-0 -translate-y-1/2 sm:block"
          >
            <div className="flex justify-center">
              <img
                src={BRAND.mark}
                alt=""
                className="w-[clamp(180px,26vw,380px)] opacity-[0.045]"
              />
            </div>
          </div>

          {/* O conteúdo passa por cima da marca. */}
          <div className="relative z-10 p-4 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
