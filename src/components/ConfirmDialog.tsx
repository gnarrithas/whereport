interface Props {
  countryName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ countryName, onConfirm, onCancel }: Props) {
  return (
    <div className="card panel bottom">
      <p>Lock in <strong>{countryName}</strong>?</p>
      <div className="actions">
        <button onClick={onCancel}>No</button>
        <button className="primary" onClick={onConfirm} autoFocus>Lock in</button>
      </div>
    </div>
  );
}
