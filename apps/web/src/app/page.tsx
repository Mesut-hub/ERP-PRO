export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>ERP-PRO</h1>
      <ul>
        <li>
          <a href="/login">Login</a>
        </li>
        <li>
          <a href="/accounting/trial-balance">Accounting: Trial Balance</a>
        </li>
        <li>
          <a href="/accounting/ledger">Accounting: Ledger</a>
        </li>
        <li>
          <a href="/accounting/grni">Accounting: GRNI (327) Reconciliation</a>
        </li>
      </ul>
    </main>
  );
}