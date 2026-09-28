import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}
