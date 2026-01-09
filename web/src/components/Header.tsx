import './Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-logo">
        <img
          src="/icons/logo-icon.svg"
          alt="UniFiLanCast"
          className="header-logo-icon"
        />
        <h1 className="header-title">UniFiLanCast</h1>
      </div>
    </header>
  );
}
