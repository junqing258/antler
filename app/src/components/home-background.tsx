import "@/styles/home-background.css";

export function HomeBackground() {
  return (
    <div className="home-background" aria-hidden="true">
      <span className="home-shape home-shape-red" />
      <span className="home-shape home-shape-green" />
      <svg className="home-shape home-shape-blue" viewBox="0 0 100 100" focusable="false">
        <path d="M 44 11 Q 50 0 56 11 L 94 79 Q 100 90 87 90 H 13 Q 0 90 6 79 Z" />
      </svg>
    </div>
  );
}
