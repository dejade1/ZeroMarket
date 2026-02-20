declare module '@kybarg/ssp' {
  interface SSPOptions {
    device: string;
    type?: string;
    id?: number;
  }

  class SSP {
    constructor(options: SSPOptions);
    on(event: string, listener: (...args: any[]) => void): this;
    open(): void;
    command(cmd: string, params?: Record<string, any>): Promise<any>;
  }

  export default SSP;
}
