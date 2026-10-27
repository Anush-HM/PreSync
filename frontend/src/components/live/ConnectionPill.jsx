import { CircleSlash, WifiOff } from 'lucide-react';
import './live.css';

const STATES = {
  connecting: { label: 'Connecting…', className: 'is-muted' },
  live: { label: 'Live', className: 'is-live' },
  reconnecting: { label: 'Reconnecting…', className: 'is-warn', icon: WifiOff },
  ended: { label: 'Ended', className: 'is-muted', icon: CircleSlash }
};

// Connection state of a live session socket, announced politely to
// screen readers when it changes.
function ConnectionPill({ state, liveLabel }) {
  const s = STATES[state] || STATES.connecting;
  const Icon = s.icon;
  return (
    <span className={`conn-pill ${s.className}`} role="status">
      {state === 'live' && <span className="live-dot" aria-hidden="true" />}
      {state === 'connecting' && <span className="spinner" aria-hidden="true" />}
      {Icon && <Icon aria-hidden="true" />}
      {state === 'live' && liveLabel ? liveLabel : s.label}
    </span>
  );
}

export default ConnectionPill;
