import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Alert } from '@prisma/client';
import { Server, Socket } from 'socket.io';

/**
 * Pushes alert events to connected clients over Socket.IO.
 *
 * Every alert is emitted twice: once on the generic `alert` channel and once on
 * a per-type channel (`alert:LOW_STOCK`, `alert:EXPIRING_BATCH`, …) so a client
 * can subscribe to just the types it cares about.
 */
@WebSocketGateway({ cors: true })
export class AlertsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AlertsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitAlert(alert: Alert): void {
    // The server may be undefined if no adapter is attached yet (e.g. a scan
    // that runs before any client connected). Guard so a background job never
    // crashes on a missing server.
    if (!this.server) {
      this.logger.warn(
        `No websocket server attached; dropping alert ${alert.id}`,
      );
      return;
    }
    this.server.emit('alert', alert);
    this.server.emit(`alert:${alert.type}`, alert);
  }
}
