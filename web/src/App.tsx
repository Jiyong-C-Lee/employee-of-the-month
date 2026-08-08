import { Shell } from '@narre/ui';
import { UI } from '@content/ui';
import { useGame } from './store';
import Home from './screens/Home.jsx';
import Lobby from './screens/Lobby.jsx';
import Game from './screens/Game.jsx';
import TunePanel from './screens/TunePanel.jsx';
import SharedRound from './screens/SharedRound.jsx';

export default function App() {
  const { state, actions } = useGame();
  // 포즈 얼굴 위치 튜닝 화면 — 게임 진입 없이 단독으로 뜬다.
  const tuning = new URLSearchParams(location.search).get('tune') === '1';
  // 공유 링크(/s/:id) — 게임 상태와 무관한 읽기 전용 라운드 뷰.
  const shared = location.pathname.startsWith('/s/');
  let screen;
  if (shared) screen = <SharedRound />;
  else if (tuning) screen = <TunePanel />;
  else if (!state.room) screen = <Home state={state} actions={actions} />;
  else if (state.room.state === 'LOBBY') screen = <Lobby state={state} actions={actions} />;
  else screen = <Game state={state} actions={actions} />;
  return (
    <Shell>
      <div className="app">
        {!tuning && !state.connected && state.room && <div className="conn-banner">{UI.app.connecting}</div>}
        {!tuning && state.toast && <div className="toast">{state.toast}</div>}
        {screen}
      </div>
    </Shell>
  );
}
