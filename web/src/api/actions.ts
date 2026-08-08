// REST 액션 래퍼. 실패는 { error } 객체로 정규화해 호출부가 항상 동일한 형태로 처리한다.
export async function post<T>(path: string, body: object): Promise<T | { error: string }> {
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T | { error: string };
  } catch {
    return { error: '서버에 연결할 수 없습니다.' };
  }
}
