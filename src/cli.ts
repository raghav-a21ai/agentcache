#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();
program.name("loop").description("Engineering Knowledge Compiler").version("0.1.0");
program.parse();
