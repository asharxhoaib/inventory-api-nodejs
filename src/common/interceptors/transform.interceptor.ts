import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Wraps successful controller results in a { success, data } envelope.
 * Responses that already look paginated ({ data, meta }) are passed through so
 * the meta stays at the top level.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (
          data !== null &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          return { success: true, ...data } as unknown as T;
        }
        return { success: true, data };
      }),
    );
  }
}
