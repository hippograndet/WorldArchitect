interface Props {
  label: string;
  colorClass: string;
}

export default function LabelBadge({ label, colorClass }: Props) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${colorClass}`}>
      {label}
    </span>
  );
}
