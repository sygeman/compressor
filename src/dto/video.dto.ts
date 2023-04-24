import { IsString } from 'class-validator';

export class VideoDto {
  @IsString()
  readonly input: string;

  @IsString()
  readonly output: string;
}
