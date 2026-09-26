import { Global, Module } from '@nestjs/common';
import { FishService } from './fish.service';

// Global so meetings module can use it without extra wiring.
@Global()
@Module({
  providers: [FishService],
  exports: [FishService],
})
export class FishModule {}
