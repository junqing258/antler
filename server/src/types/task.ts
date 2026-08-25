export type Task = {
  id: string;
  message: string;
  status: 'queued' | 'running' | 'completed';
};
