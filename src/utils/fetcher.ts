export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    credentials: 'include'
  });
  if (!res.ok) {
    throw new Error('Network response was not ok');
  }
  return res.json();
}
