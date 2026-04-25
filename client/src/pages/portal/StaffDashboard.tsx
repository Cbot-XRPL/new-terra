import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

interface Schedule {
  id: string;
  title: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
  project: { name: string; address?: string | null };
}

interface BoardPost {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { name: string; role: string };
}

interface Overview {
  schedules: Schedule[];
  board: BoardPost[];
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/api/portal/staff/overview')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>Hello, {user?.name.split(' ')[0]}</h1>
        <p className="muted">Schedule, message board, and project tools.</p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2>Upcoming schedule</h2>
        {data?.schedules.length ? (
          <ul className="list">
            {data.schedules.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong>
                <div className="muted">
                  {s.project.name}
                  {s.project.address && ` — ${s.project.address}`}
                </div>
                <div className="muted">
                  {new Date(s.startsAt).toLocaleString()} → {new Date(s.endsAt).toLocaleString()}
                </div>
                {s.notes && <p>{s.notes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing scheduled.</p>
        )}
      </section>

      <section className="card">
        <h2>Company message board</h2>
        {data?.board.length ? (
          <ul className="list">
            {data.board.map((p) => (
              <li key={p.id}>
                <strong>{p.pinned ? '📌 ' : ''}{p.title}</strong>
                <div className="muted">
                  {p.author.name} · {new Date(p.createdAt).toLocaleString()}
                </div>
                <p>{p.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No posts yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Coming soon</h2>
        <ul>
          <li>Upload site photos to a project</li>
          <li>Add log entries to a project</li>
          <li>Message a customer directly</li>
        </ul>
      </section>
    </div>
  );
}
