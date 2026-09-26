import { Controller, Get } from '@nestjs/common';
import { LANGUAGES } from './languages';

@Controller('languages')
export class LanguagesController {
  @Get()
  get() {
    return LANGUAGES;
  }
}
