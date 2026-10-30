/* Shared browser/Node coordinator. Budget selection happens before dispatch;
   ordered reply slots make completion timing irrelevant. One edit at a time. */
export class RoutingPool {
  constructor(clients) { this.clients = clients; this.running = false; }
  async edit(message) {
    if (this.running) throw new Error('Routing pool is busy');
    this.running = true;
    try {
      let result = await this.clients[0]({...message, type: 'edit'});
      let searchCompute = 0;
      while (result.type === 'jobs') {
        const jobs = result.jobs, replies = new Array(jobs.length);
        let next = 0;
        await Promise.all(this.clients.map(async client => {
          while (next < jobs.length) {
            const index = next++;
            replies[index] = await client({type: 'job', job: jobs[index]});
            searchCompute += replies[index].compute_ms;
          }
        }));
        result = await this.clients[0]({type: 'resume', replies});
      }
      result.timings.search_compute_ms = searchCompute + (result.timings.bound_ms || 0);
      return result;
    } finally { this.running = false; }
  }
}
