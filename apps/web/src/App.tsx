// 원본 App.jsx에서 debate(토론) 분기를 제거한 버전. screens/*.jsx는 Task 14에서 실제 이식으로 교체된다.
import { useGame } from './store';
import Home from './screens/Home.jsx';
import Lobby from './screens/Lobby.jsx';
import Game from './screens/Game.jsx';

export default function App() {
  const { state, actions } = useGame();
  let screen;
  if (!state.room) screen = <Home state={state} actions={actions} />;
  else if (state.room.state === 'LOBBY') screen = <Lobby state={state} actions={actions} />;
  else screen = <Game state={state} actions={actions} />;
  return (
    <div className="app">
      {!state.connected && state.room && <div className="conn-banner">서버 연결 중…</div>}
      {state.toast && <div className="toast">{state.toast}</div>}
      {screen}
    </div>
  );
}
