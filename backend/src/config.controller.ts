import { Controller, Get } from '@nestjs/common';
import { UsageService } from './usage.service';

// GET /api/config -- what the page needs to know before showing its forms
// (whether creating a meeting asks for an access code).
@Controller('config')
export class ConfigController {
  constructor(private usage: UsageService) {}

  @Get()
  get() {
    return { accessCodeRequired: this.usage.accessCodeRequired() };
  }
}
