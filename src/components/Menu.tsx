interface Props {
  onNewGame: () => void;
}

export default function Menu({ onNewGame }: Props) {
  return (
    <div className="overlay blurred">
      <div className="card menu">
        <h1>Guess the Country</h1>
        <p>Find the named country on the map.</p>
        <button className="primary" onClick={onNewGame}>New game</button>
      </div>
    </div>
  );
}
