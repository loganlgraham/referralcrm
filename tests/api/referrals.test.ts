import request from 'supertest';

describe('Referrals API', () => {
  it('requires authentication for POST', async () => {
    const response = await request('http://localhost:3000').post('/api/referrals').send({});
    expect([401, 405]).toContain(response.status);
  });
});
