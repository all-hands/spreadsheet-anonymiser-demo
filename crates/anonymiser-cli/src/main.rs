use clap::{CommandFactory, FromArgMatches, Parser, Subcommand};

mod args;
mod cmd_anonymise;
mod cmd_depseudo;
mod cmd_inspect;
mod cmd_keygen;
mod cmd_verify;
mod io;
mod manifest;
mod manifest_check;
mod mapping_file;
mod pii;
mod plan;
mod policy_file;
mod profile;
mod salt_file;
mod secret_file;
mod session;
mod verify_generalised;
mod verify_report;

#[derive(Parser, Debug)]
#[command(
    name = "anonymiser",
    version,
    about = "CSV pseudonymiser backed by anonymiser-core (pseudonymised ≠ anonymous)"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Pseudonymise (or decrypt) a CSV: keyed tokens, redact, mask, faux,
    /// reversible encryption.
    Anonymise(Box<args::AnonymiseArgs>),
    /// Create a versioned master-key file, or upgrade a legacy raw key
    /// in place.
    Keygen(cmd_keygen::KeygenArgs),
    /// Read-only dry-run: plan, cardinalities, k-anonymity of kept
    /// and generalised columns, PII hints, sample tokens.
    Inspect(cmd_inspect::InspectArgs),
    /// Audit a pseudonymised output: key id, token shape, kept-column PII,
    /// and optional re-derivation against the original.
    Verify(cmd_verify::VerifyArgs),
    /// Reverse tokens through a --reversible mapping sidecar.
    Depseudo(cmd_depseudo::DepseudoArgs),
}

fn main() -> anyhow::Result<()> {
    let matches = Cli::command().get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());
    match cli.command {
        Command::Anonymise(args) => {
            let sub = matches
                .subcommand_matches("anonymise")
                .expect("clap parsed the anonymise subcommand");
            cmd_anonymise::run(*args, sub)
        }
        Command::Keygen(args) => cmd_keygen::run(args),
        Command::Inspect(args) => cmd_inspect::run(args),
        Command::Verify(args) => cmd_verify::run(args),
        Command::Depseudo(args) => cmd_depseudo::run(args),
    }
}
