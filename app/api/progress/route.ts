import { cookies } from 'next/headers';
import { database } from '../../../db/client';
import { validProgress } from '../../lab-progress';

const cookieName = 'netops_save';
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });

export async function GET(request: Request) {
  try {
    const jar = await cookies();
    const previous = jar.get(cookieName)?.value;
    const id =
      previous && idPattern.test(previous) ? previous : crypto.randomUUID();
    const db = database();
    await db
      .prepare('INSERT OR IGNORE INTO lab_saves (id, updated_at) VALUES (?, ?)')
      .bind(id, Date.now())
      .run();
    const row = await db
      .prepare('SELECT progress, revision FROM lab_saves WHERE id = ?')
      .bind(id)
      .first<{ progress: string | null; revision: number }>();
    jar.set(cookieName, id, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return response({
      progress: row?.progress ? JSON.parse(row.progress) : null,
      revision: row?.revision ?? 0,
    });
  } catch {
    return response(
      { error: 'Saved progress is unavailable. Please retry.' },
      503,
    );
  }
}

export async function PUT(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return response({ error: 'Cross-origin save rejected.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return response({ error: 'JSON required.' }, 415);
  try {
    const id = (await cookies()).get(cookieName)?.value;
    if (!id || !idPattern.test(id))
      return response({ error: 'Open the lab before saving.' }, 401);
    if (Number(request.headers.get('content-length')) > 2500000)
      return response({ error: 'Save is too large.' }, 413);
    const raw = await request.text();
    if (raw.length > 2500000)
      return response({ error: 'Save is too large.' }, 413);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return response({ error: 'Invalid save.' }, 400);
    }
    if (
      !data ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0 ||
      !validProgress(data.progress)
    )
      return response({ error: 'Invalid or unsupported checkpoint.' }, 400);
    const result = await database()
      .prepare(
        'UPDATE lab_saves SET progress = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
      )
      .bind(JSON.stringify(data.progress), Date.now(), id, data.revision)
      .run();
    if (result.meta.changes !== 1)
      return response(
        {
          error:
            'Another tab changed this save. Reload to resume the latest checkpoint.',
        },
        409,
      );
    return response({ revision: data.revision + 1 });
  } catch {
    return response({ error: 'Progress could not be saved.' }, 503);
  }
}
