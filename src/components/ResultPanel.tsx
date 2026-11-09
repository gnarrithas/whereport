interface Props {
  correct: boolean;
  neighbor: boolean;
  guessName: string;
  targetName: string;
  onNewGame: () => void;
  onMenu: () => void;
}

export default function ResultPanel({ correct, neighbor, guessName, targetName, onNewGame, onMenu }: Props) {
  return (
    <div className="card panel bottom">
      {correct ? (
        <h2 className="good">Correct! That's {targetName}.</h2>
      ) : (
        <>
          <h2 className="bad">Wrong — you picked {guessName}.</h2>
          <p>
            {neighbor
              ? <>Close: {targetName} <strong>is a neighbor</strong> of {guessName}.</>
              : <>{targetName} is <strong>not a neighbor</strong> of {guessName}.</>}
          </p>
        </>
      )}
      <div className="actions">
        <button onClick={onMenu}>Menu</button>
        <button className="primary" onClick={onNewGame} autoFocus>New game</button>
      </div>
    </div>
  );
}
